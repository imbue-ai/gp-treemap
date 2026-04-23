/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import <Cocoa/Cocoa.h>


@class TreeContext;


/* A tree context with additional text comments that allow human-readable information to be
 * associated with the scan data. The comments can be used by the application to document the use of
 * a filter, but also for the user to provide further background information with respect to the
 * scan, e.g. "My harddrive just before upgrading to Snow Leopard".
 */
@interface AnnotatedTreeContext : NSObject {
}

+ (instancetype) annotatedTreeContext:(TreeContext *)treeContext;
+ (instancetype) annotatedTreeContext:(TreeContext *)treeContext
                             comments:(NSString *)comments;

// Overrides designated initialiser
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithTreeContext:(TreeContext *)treeContext;
- (instancetype) initWithTreeContext:(TreeContext *)treeContext
                            comments:(NSString *)comments NS_DESIGNATED_INITIALIZER;

@property (nonatomic, readonly, strong) TreeContext *treeContext;
@property (nonatomic, readonly, copy) NSString *comments;

@end
